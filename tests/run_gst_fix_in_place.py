"""python3 run_gst_fix_in_place.py - GST › What to fix: an entry corrected where it is shown (the owner, 23-Nov-2026: "any
error should be rectified there only.. option of open in entry should pop up a new window there only...and that change
should be made to tally and fincom books also"; the forms approved the same day, decisions 1, 2, 4-7).

FinCom Bridge is stood in at the network (window.fetch: its /ping proves itself with the key, /fix answers as
bridge-go/fixalter.go does), so the real Bridge.call is what FinCom's /fix goes through. Every answer kind is covered:
  1. "Open the entry" opens a window on the same page (not Look up), with only the box its kind of error needs;
  2. ok, with the entry read back: "Saved in Tally and FinCom Books.", Tally's entry replaces FinCom's, the row leaves;
     ok without a read back: "Saved in Tally." and FinCom Books update at the next read;
  3. refused (ok:false): Tally's own words, nothing changed, never sent again by itself;
  4. changed since: "Changed in Tally since you opened it", Tally's entry brought in, the next Save uses its AlterID;
  5. kept, unknown (Ask Tally again, by a person only), gone, a refusal before sending: said, never sent again by itself;
  6. held (Tally closed) and a network error: kept, Waiting for Tally, Save off; sent again when Tally is open;
  7. an older FinCom Bridge (404 Unknown address /fix): says it needs FinCom Bridge 2.5.21, never sent again by itself;
  8. another client opened while a change is with Tally, and during the sending of the held ones: the answer goes to the
     books of the client it was made for, never the one open now; the window closes when a client opens;
  9. Undo: one change for a double click, marked used only once Tally took it; a place of supply goes back to Tally's
     own value (the bridge's before); the ledger's AlterID is sent when FinCom Books have it.
 10. A GSTIN (the owner, 24-Nov-2026): after the ledger is saved, that party's invoices of the month on screen with
     another GSTIN or none are listed, all ticked; each is sent on its own (target voucher, fields {gstin}, the voucher
     type unescaped: "Sales & Services") and read back; the row leaves What to fix only when its invoice is corrected.
     The ledger already right: Save is offered and goes to the invoices only. A ledger with no change number in FinCom
     Books: the same Save reads it from Tally first (readFirst), then saves with Tally's change number; Tally closed:
     held; Tally's GSTIN another: changed since.
 11. Changed since: the window's title, place of supply and GSTIN rows and the unchanged test follow Tally's entry;
     FixQ.mine compares exactly; Tally holding the value though this computer did not send it: "Already in Tally", no
     Undo; only changes made on this computer are sent again by themselves (rec.dev); Changes made here (N) counts the
     ones Tally took; at most 200 kept, the oldest dropped; fixq is not a GST part (GSTR.NOT_GST); ledRead keeps alterId.
Made-up books only (tests/fixtures/books). Screenshots (deviceScaleFactor 2) go to FIX_SHOTS when set: classic light and
New look dark of refused, changed, needs the newer bridge and waiting, and (SHOT_PREFIX) the invoices step and the ledger
read from Tally first. Runs on the React build: app/dist-test."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FIXIP_PORT") or 8341)
SHOTS = os.environ.get("FIX_SHOTS", "")
PFX = os.environ.get("SHOT_PREFIX", "")
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
# an entry changed as a new read of the books changes it: a new object in its place
PLANT = "(a) => { const vs = S.books.vouchers, i = vs.findIndex(v => v.id === a[0]); vs[i] = Object.assign({}, vs[i], {no: a[1], alt: a[2]}); BOOKS_REV++; render(); }"
LONG, SHORT, BADG = "LFE/2025-26/000006", "LFE/25-26/006", "07AAJFQ3158R1ZJ"
BURL, BKEY, BID = "http://127.0.0.1:9177", "k-fix-test-0001", "bid-fix-test"
WAIT = "Waiting for Tally. It is saved there when Tally is open."
# FinCom Bridge stood in at the network: /ping proves itself with the key held; /fix is kept and answered by window.__fix,
# which gives {status, body}, "net" (no answer) or a promise of either (an answer still on its way)
STUB = """(c) => { window.__calls = []; window.__live = true; window.bridgeLive = () => window.__live;
  window.ensureTallyCompany = async (co) => 'Tally of ' + co.name; window.linkGuid = async (co) => ({guid: 'g-' + co.id});
  LinkRec.guidFor = async (co) => 'g-' + co.id;
  Bridge.setCfg({url: c.url, key: c.key, bridgeId: c.id}); Bridge.foundAt = Date.now();
  const real = window.fetch.bind(window), J = (o, s) => new Response(JSON.stringify(o), {status: s || 200, headers: {'Content-Type': 'application/json'}});
  window.fetch = async (u, o) => { u = String(u);
    if (!/^http:\\/\\/127\\.0\\.0\\.1:91\\d\\d/.test(u)) return real(u, o);
    if (!u.startsWith(c.url)) throw new TypeError('Failed to fetch');
    const path = u.slice(c.url.length);
    if (path.startsWith('/ping')) { const n = new URL(u).searchParams.get('n'); return J({ok: true, bridgeId: c.id, port: 9177, proof: await Bridge.hmac(c.key, n + c.id + 9177)}); }
    if (path.startsWith('/fix')) { const body = JSON.parse(o.body); window.__calls.push(['/fix', body, (o.headers || {})['X-Bridge-Key']]);
      const a = await window.__fix(body); if (a === 'net') throw new TypeError('Failed to fetch'); return J(a.body, a.status); }
    if (path.startsWith('/status')) return J({ok: true, linkGuid: true, sessions: []});
    return J({ok: false, error: 'Unknown address ' + path.split('?')[0]}, 404); }; }"""
# Tally's entry as the bridge reads it back: FinCom's own entry with the number and change number given
XML = """(a) => { const v = S.books.vouchers.find(x => x.id === a[0]), e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<VOUCHER VCHTYPE="' + e(v.type) + '"><GUID>' + e(v.id) + '</GUID><ALTERID>' + a[2] + '</ALTERID><DATE>' + v.date + '</DATE><VOUCHERTYPENAME>' + e(v.type) +
    '</VOUCHERTYPENAME><VOUCHERNUMBER>' + e(a[1]) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + e(v.party) + '</PARTYLEDGERNAME><PARTYGSTIN>' + e(v.gstin) +
    '</PARTYGSTIN><PLACEOFSUPPLY>' + e(v.pos) + '</PLACEOFSUPPLY>' + (v.ent || []).map(l => '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + e(l.l) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
    (l.a < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + l.a + '</AMOUNT></ALLLEDGERENTRIES.LIST>').join('') + '</VOUCHER>'; }"""
WHAT = "Invoice numbers longer than 16 characters"

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

def save_off(pg):
    return pg.evaluate("() => { const b = document.querySelector('[data-fix-entry] [data-fix-save]'); return !b || b.disabled; }")

def calls(pg):
    return pg.evaluate("window.__calls")

def answer(pg, js):
    pg.evaluate("() => { window.__fix = " + js + "; }")

def cancel(pg):
    pg.evaluate("() => { const w = document.querySelector('[data-fix-entry] [data-fix-cancel]'); if (w) w.click(); }"); pg.wait_for_timeout(250)

def voucher(pg, vid):
    return pg.evaluate("(id) => { const v = S.books.vouchers.find(x => x.id === id); return v && {no: v.no, alt: v.alt}; }", vid)

# the held changes sent now, as a page drawn a minute later sends them (FixQ.pump)
def pump(pg, ms=900):
    pg.evaluate("() => { window.FixQ.last = 0; return window.FixQ.pump(true); }"); pg.wait_for_timeout(ms)

alt = [100]
def try_save(pg, vid, js, ms=900):
    """the entry with the long number again (as a new read brings it), opened, a good number typed, Save pressed, the
    bridge answering js"""
    alt[0] += 2
    pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    answer(pg, js)
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(ms)
    return state(pg)

def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, PFX + name + ".png"))

REFUSED = "(b) => ({body: {ok: false, refused: true, message: \"Tally did not change it: Voucher Number 'LFE/25-26/006' already exists.\"}})"
CHANGED = "(b) => ({body: {ok: false, changed: true, now: {number: 'LFE/2025-26/000106', alterId: '61'}, alterNow: '61', xml: window.__xml, message: 'Changed in Tally since it was opened here. This is how it is now.'}})"
OLD = "(b) => ({status: 404, body: {ok: false, error: 'Unknown address /fix'}})"
HELD = "(b) => ({body: {ok: false, held: true, message: 'Tally is closed. The change is made when it opens.'}})"
DONE = "(b) => ({body: {ok: true, message: 'Saved in Tally.', before: {number: 'x', alterId: String(b.alterId)}, after: {number: b.fields.number, alterId: String(+b.alterId + 1)}, alterAfter: String(+b.alterId + 1), xml: window.__xmlOf(b)}})"
# Tally's entry read back after a Save: the number sent and the next change number
XMLOF = "() => { window.__xmlOf = (b) => (" + XML + ")([b.guid, b.fields.number, +b.alterId + 1]); }"

def dark_shots(pg, vid, tag):
    """the four answers drawn again in the look now on screen"""
    try_save(pg, vid, REFUSED); shot(pg, tag + "-refused"); cancel(pg)
    pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, "LFE/2025-26/000106", 61])
    try_save(pg, vid, CHANGED); shot(pg, tag + "-changed"); cancel(pg)
    try_save(pg, vid, OLD); shot(pg, tag + "-needs-newer-bridge"); cancel(pg)
    try_save(pg, vid, HELD); shot(pg, tag + "-waiting"); cancel(pg)
    answer(pg, DONE); pump(pg)

# Tally's invoice as read back after its GSTIN fix: the voucher type as Tally gives it (escaped once, as FinCom keeps it)
XMLG = """(a) => { const v = S.books.vouchers.find(x => x.id === a[0]), e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<VOUCHER VCHTYPE="' + v.type + '"><GUID>' + e(v.id) + '</GUID><ALTERID>' + a[2] + '</ALTERID><DATE>' + v.date + '</DATE><VOUCHERTYPENAME>' + v.type +
    '</VOUCHERTYPENAME><VOUCHERNUMBER>' + e(v.no) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + e(v.party) + '</PARTYLEDGERNAME><PARTYGSTIN>' + e(a[1]) +
    '</PARTYGSTIN><PLACEOFSUPPLY>' + e(v.pos) + '</PLACEOFSUPPLY>' + (v.ent || []).map(l => '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + e(l.l) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
    (l.a < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + l.a + '</AMOUNT></ALLLEDGERENTRIES.LIST>').join('') + '</VOUCHER>'; }"""
# the bridge: a ledger read first, a ledger fix, an invoice's GSTIN fix (read back with the GSTIN sent)
GSTFIX = """(b) => b.readFirst ? {body: {ok: false, read: true, now: {gstin: window.__tallyG, pan: '', alterId: '40'}, alterNow: '40', message: 'Read from Tally.'}}
  : b.target === 'ledger' ? {body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: String(+b.alterId + 1)}, before: {gstin: b.was.gstin, alterId: b.alterId}}}
  : {body: {ok: true, message: 'Saved in Tally.', before: {gstin: 'x', alterId: b.alterId}, after: {gstin: b.fields.gstin, alterId: String(+b.alterId + 1)}, xml: (""" + XMLG + """)([b.guid, b.fields.gstin, +b.alterId + 1])}}"""
def inv_state(pg):
    return pg.evaluate("""() => { const w = document.querySelector('[data-fix-entry]'); if (!w) return null; const l = w.querySelector('[data-fix-invoices]');
      return {step: w.dataset.fixStep, rows: l ? Array.from(l.querySelectorAll('[data-fix-inv]')).map(r => [r.dataset.fixInv, r.querySelector('[data-fix-tick]').checked, r.dataset.fixInvState]) : null,
        save: (() => { const b = w.querySelector('[data-fix-save]'); return !!b && !b.disabled; })(), text: w.innerText.replace(/\\s+/g, ' ')}; }""")
def bad_again(pg, gid, g):
    """the invoice with a GSTIN that is not valid again (as a new read brings it)"""
    pg.evaluate("(a) => { const vs = S.books.vouchers, i = vs.findIndex(v => v.id === a[0]); vs[i] = Object.assign({}, vs[i], {gstin: a[1], alt: (vs[i].alt || 70) + 5}); BOOKS_REV++; render(); }", [gid, g])

def invoice_steps(pg, what2, gid, led, good):
    # 10. the ledger saved: the party's invoices of the month with another GSTIN, all ticked
    pg.wait_for_timeout(300)
    s1 = inv_state(pg)
    ok(s1 and s1["step"] == "invoices" and s1["rows"] and [gid, True, ""] in s1["rows"] and s1["save"],
       "the ledger saved: the party's invoices of the month with another GSTIN listed, all ticked, Save offered (%s)" % (s1 and {k: s1[k] for k in ("step", "rows", "save")}))
    ok(gid in (group(pg, what2) or []), "the ledger saved but the invoice not yet: its row is still in What to fix")
    shot(pg, "classic-light-invoices")
    # the voucher type as Tally gives it, escaped once in FinCom Books: sent as Tally's own name
    pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); v.type = 'Sales &amp; Services'; if (v.alt == null) v.alt = 70; }", gid)
    alt0 = pg.evaluate("(g) => S.books.vouchers.find(x => x.id === g).alt", gid)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1200)
    c = calls(pg); b = c[0][1] if c else {}
    ok(len(c) == 1 and b.get("target") == "voucher" and b.get("guid") == gid and b.get("fields") == {"gstin": good} and b.get("alterId") == str(alt0)
       and b.get("vchType") == "Sales & Services" and b.get("vchDate"), "each invoice sent on its own: its GSTIN only, its change number, the type as Tally's name 'Sales & Services' (%s)" % b)
    v = pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return [v.gstin, v.alt, v.type]; }", gid)
    ok(v == [good, alt0 + 1, "Sales &amp; Services"], "the invoice read back is in FinCom Books (%s)" % v)
    pg.wait_for_timeout(1300)
    ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "every ticked invoice saved: the window closes by itself")
    rows = group(pg, what2)
    ok(not rows or gid not in rows, "the invoice corrected: its row has left What to fix (%s)" % rows)

    # the ledger already right, the invoice not: the box pre-filled valid, Save offered for the invoices only
    bad_again(pg, gid, BADG); month(pg, "202504")
    rows = group(pg, what2)
    ok(rows and gid in rows, "the invoice with a bad GSTIN again: listed (%s)" % rows)
    w = open_entry(pg, what2, gid); s2 = inv_state(pg)
    ok(s2["step"] == "invoices" and [gid, True, ""] in (s2["rows"] or []) and s2["save"] and "The party ledger has this GSTIN." in s2["text"],
       "the ledger already right: straight to its invoices, ticked, Save offered (%s)" % {k: s2[k] for k in ("step", "rows", "save")})
    # unticked: nothing to send, Save off; ticked again
    pg.click("[data-fix-entry] [data-fix-tick]"); pg.wait_for_timeout(150)
    ok(not inv_state(pg)["save"], "every invoice unticked: Save is off")
    pg.click("[data-fix-entry] [data-fix-tick]"); pg.wait_for_timeout(150)
    pg.evaluate("() => { window.__calls = []; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1500)
    c = calls(pg)
    ok(len(c) == 1 and c[0][1].get("target") == "voucher" and c[0][1].get("fields") == {"gstin": good}, "the ledger already right: only the invoice is sent (%s)" % [x[1].get("target") for x in c])
    rows = group(pg, what2)
    ok(not rows or gid not in rows, "the row leaves the list once its invoice is fixed (%s)" % rows)

    # a ledger FinCom Books hold no change number for: the same Save reads it from Tally first, then saves
    bad_again(pg, gid, BADG)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    open_entry(pg, what2, gid); typein(pg, good)
    pg.evaluate("() => { window.__calls = []; window.__tallyG = '" + BADG + "'; const f = " + GSTFIX + "; window.__go = null; window.__fix = (b) => b.readFirst ? new Promise((r) => { window.__go = () => r(f(b)); }) : f(b); }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
    st = state(pg)
    ok(st and st[0] == "waiting" and "Reading the party from Tally" in st[1] and save_off(pg), "no change number: Save reads the party from Tally first (%s)" % st)
    ok(not pg.evaluate("() => /Read the ledgers from Tally first/.test(document.body.innerText)"), "no step asked of the person: no 'Read the ledgers from Tally first'")
    shot(pg, "classic-light-ledger-read-first")
    pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1200)
    c = calls(pg)
    ok(len(c) == 2 and c[0][1].get("readFirst") is True and "alterId" not in c[0][1] and c[1][1].get("alterId") == "40" and "readFirst" not in c[1][1] and c[1][1].get("target") == "ledger",
       "one Save: the ledger read from Tally, then its fix with Tally's change number (%s)" % [(x[1].get("readFirst"), x[1].get("alterId")) for x in c])
    s3 = inv_state(pg)
    ok(s3 and s3["step"] == "invoices" and pg.evaluate("(l) => S.books.ledInfo[l] && S.books.ledInfo[l].alt", led) == 41, "then the invoices step; the ledger's change number kept even with no ledger details before (%s)" % (s3 and s3["step"]))
    cancel(pg)
    # Tally closed at the read: held as usual; Tally's GSTIN another: changed since, nothing sent
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    open_entry(pg, what2, gid); typein(pg, good)
    pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: false, held: true, message: 'Tally is closed. The change is made when it opens.'}}); }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(900)
    st = state(pg)
    ok(st and st[0] == "waiting" and len(calls(pg)) == 1 and calls(pg)[0][1].get("readFirst") is True, "no change number, Tally closed: held, Waiting for Tally (%s)" % st)
    pg.evaluate("() => { window.__calls = []; window.__tallyG = '27AAPFU0939F1ZV'; window.__fix = " + GSTFIX + "; }")
    pump(pg, 1200)
    last = pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1]")
    ok(len(calls(pg)) == 1 and last["state"] == "changed", "sent when Tally opens: Tally's GSTIN is another, so changed since and nothing sent (%s, %d calls)" % (last["state"], len(calls(pg))))
    ok(pg.evaluate("(l) => S.books.gstins[l]", led) == "27AAPFU0939F1ZV", "changed since: FinCom Books take Tally's GSTIN of the ledger")
    cancel(pg)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, good])

def should_fix(pg, vid):
    """11. the review's should-fix items"""
    b0 = pg.evaluate("() => S.books.fixq.length")
    # only this computer's changes are sent again by themselves; a colleague's shown
    pg.evaluate("""() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq.filter(y => y.ask && y.ask.target === 'voucher').slice(-1)[0]));
      x.id = 'fx-colleague'; x.state = 'waiting'; x.dev = 'dev-colleague'; x.by = 'colleague@example.com'; x.words = 'Waiting'; b.fixq.push(x); render(); }""")
    pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {}}}); }")
    pump(pg)
    ok(len(calls(pg)) == 0, "a colleague's waiting change is never sent from this computer (%d calls)" % len(calls(pg)))
    h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); h.open = true; return h.textContent.replace(/\\s+/g, ' '); }")
    ok("colleague@example.com" in h and "sent from the computer it was made on" in h, "a colleague's change is shown, with who made it (%r)" % h[-200:])
    pg.evaluate("() => { S.books.fixq = S.books.fixq.filter(x => x.id !== 'fx-colleague'); render(); }")
    ok(pg.evaluate("() => S.books.fixq.every(x => !x.ask || x.id.startsWith('fx-') && !x.dev || x.dev === FixQ.dev())"), "each change made here carries this computer's id")
    # FixQ.mine: exact
    m = pg.evaluate("""() => [FixQ.mine({ask: {fields: {number: 'Lfe/1'}}}, {number: 'LFE/1'}), FixQ.mine({ask: {fields: {number: 'LFE/1'}}}, {number: 'LFE/1'}),
      FixQ.mine({ask: {fields: {pos: '27'}}}, {pos: 'Maharashtra'}), FixQ.mine({ask: {fields: {gstin: '07AAJFQ3158R1ZJ'}}}, {gstin: '07aajfq3158r1zj'})]""")
    ok(m == [False, True, True, False], "FixQ.mine compares exactly (letter case too), a state by code or Tally's name (%s)" % m)
    # Tally holds the value, not sent from here: already in Tally, no Undo
    alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    answer(pg, "(b) => ({body: {ok: false, changed: true, now: {number: b.fields.number, alterId: '777'}, alterNow: '777', xml: window.__xmlOf(Object.assign({}, b, {alterId: 776}))}})")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(900)
    st = state(pg)
    last = pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1]")
    ok(st and st[0] == "already" and "Already in Tally" in st[1] and last["state"] == "already", "Tally already holds it, not sent from here: Already in Tally (%s)" % st)
    pg.wait_for_timeout(1300)
    ok(not pg.evaluate("(i) => Array.from(document.querySelectorAll('#app [data-fix-undo]')).some(u => u.dataset.fixUndo === i)", last["id"]), "already in Tally: no Undo")
    # Changes made here (N): only the ones Tally took
    n = pg.evaluate("() => [S.books.fixq.filter(x => x.state === 'done').length, (document.querySelector('#app [data-fix-history] summary') || {}).textContent]")
    ok(n[1] == "Changes made here (%d)" % n[0] and n[0] < pg.evaluate("() => S.books.fixq.length"), "Changes made here counts the changes Tally took (%s)" % n)
    # at most 200 kept, the oldest dropped
    pg.evaluate("""() => { const b = S.books; for (let i = 0; i < 210; i++) b.fixq.push({id: 'fx-old' + i, cid: b.cid, at: '2026-01-01', state: 'refused', label: 'old ' + i, ask: {target: 'voucher', fields: {number: 'X'}}, dev: FixQ.dev()}); window.__live = false; }""")
    pg.evaluate("(v) => FixQ.add({target: 'voucher', guid: v, alterId: '1', vchType: 'Sales', vchDate: '20250701', fields: {number: 'CAP-1'}}, 'cap', {kind: 'number', vid: v, was: 'x', to: 'CAP-1'})", vid); pg.wait_for_timeout(300)
    q = pg.evaluate("() => [S.books.fixq.length, S.books.fixq[S.books.fixq.length - 1].label, S.books.fixq.some(x => x.id === 'fx-old0'), S.books.fixq.some(x => x.id === 'fx-old209')]")
    ok(q == [200, "cap", False, True], "at most 200 changes kept, the oldest dropped (%s)" % q)
    pg.evaluate("() => { S.books.fixq = S.books.fixq.filter(x => !String(x.id).startsWith('fx-old') && x.label !== 'cap'); window.__live = true; render(); }")
    ok(pg.evaluate("() => GSTR.NOT_GST.has('fixq')"), "fixq is not a part GST reads (GSTR.NOT_GST)")

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
        A = pg.evaluate("S.books.cid"); ALT0 = voucher(pg, vid)["alt"]
        pg.evaluate(STUB, {"url": BURL, "key": BKEY, "id": BID}); pg.evaluate(XMLOF)

        # 1. the window on the page, the number's box only
        month(pg, "202507")
        rows = group(pg, WHAT)
        ok(rows and vid in rows, "Jul-2025: the long number's row in What to fix (%s)" % rows)
        w = open_entry(pg, WHAT, vid)
        ok(w["kind"] == "number" and w["input"] == ["number", LONG] and w["save"] and w["lookup"] and w["tab"] == "gst",
           "Open the entry: a window on the same page, the invoice number in its box, Save in Tally, Open in Look up (%s)" % {k: w[k] for k in ("kind", "input", "save", "tab")})
        ok("The portal takes at most 16 characters in an invoice number." in w["text"] and w["warn"] == 0, "the reason in plain words, nothing shown as a warning (%r)" % w["text"][:200])
        ok(save_off(pg), "Save waits until the number fits")
        typein(pg, "LFE/25-26/0006 X")
        ok(save_off(pg), "a space is not taken (the portal's characters only)")
        typein(pg, SHORT)
        ok(not save_off(pg) and "13 of 16" in pg.evaluate("() => document.querySelector('[data-fix-count]').innerText"), "13 of 16: Save is offered")

        # 3. refused, with the answer still on its way first: Save is off while it is with Tally
        pg.evaluate("() => { window.__go = null; window.__fix = (b) => new Promise((r) => { window.__go = r; }); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
        ok(save_off(pg) and (state(pg) or [""])[0] == "waiting", "while the change is with Tally: Saving, Save is off (%s)" % state(pg))
        pg.evaluate("() => window.__go({body: {ok: false, refused: true, message: \"Tally did not change it: Voucher Number 'LFE/25-26/006' already exists.\"}})"); pg.wait_for_timeout(700)
        c = calls(pg); body = c[-1][1] if c else {}
        ok(len(c) == 1 and c[0][0] == "/fix" and c[0][2] == BKEY and body.get("target") == "voucher" and body.get("guid") == vid and body.get("fields") == {"number": SHORT}
           and body.get("companyGuid") == "g-" + A and body.get("company", "").startswith("Tally of ") and body.get("alterId") == str(ALT0) and body.get("vchDate") and body.get("vchType"),
           "Save goes through Bridge.call to /fix with the key: the entry's Tally id, change number, type, date and the new number only (%s)" % body)
        st = state(pg)
        ok(st and st[0] == "refused" and "already exists" in st[1], "refused: Tally's own words in the window (%s)" % st)
        ok(voucher(pg, vid) == {"no": LONG, "alt": ALT0}, "refused: nothing changed in FinCom Books (%s)" % voucher(pg, vid))
        ok(not save_off(pg), "refused: the typed number stays and Save can be pressed again")
        shot(pg, "classic-light-refused")
        pump(pg); ok(len(calls(pg)) == 1, "refused: never sent again by itself (%d calls)" % len(calls(pg)))
        cancel(pg)

        # 4. changed since: said, Tally's entry brought in, the next Save uses Tally's change number
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, "LFE/2025-26/000106", 61])
        pg.evaluate("() => { window.__calls = []; }")
        month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT); answer(pg, CHANGED)
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(900)
        st = state(pg)
        ok(st and st[0] == "changed" and st[1].startswith("Changed in Tally since you opened it"), "changed since: said plainly, nothing saved (%s)" % st)
        ok(voucher(pg, vid) == {"no": "LFE/2025-26/000106", "alt": 61}, "changed since: FinCom takes the entry as Tally has it now (%s)" % voucher(pg, vid))
        tt = pg.evaluate("() => document.querySelector('[data-fix-entry]').innerText")
        ok("LFE/2025-26/000106" in tt.split("\n")[0] and LONG not in tt.split("\n")[0], "changed since: the window's title is Tally's number now (%r)" % tt[:80])
        typein(pg, "LFE/2025-26/000106"); pg.wait_for_timeout(150)
        ok(save_off(pg), "changed since: the unchanged test is against Tally's number now (Save off for it)")
        typein(pg, SHORT)
        shot(pg, "classic-light-changed")
        pump(pg); ok(len(calls(pg)) == 1, "changed since: never sent again by itself (%d calls)" % len(calls(pg)))

        # 2. saved, from the same window: the next Save carries Tally's change number; the entry read back replaces FinCom's
        answer(pg, DONE)
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(900)
        c = calls(pg)
        ok(len(c) == 2 and c[-1][1].get("alterId") == "61", "Save again: sent with Tally's change number now (%s)" % (c[-1][1].get("alterId") if c else None))
        st = state(pg)
        ok(st and st[0] == "done" and st[1] == "Saved in Tally and FinCom Books.", "saved with the entry read back: Saved in Tally and FinCom Books. (%s)" % st)
        pg.wait_for_timeout(1500)
        ok(voucher(pg, vid) == {"no": SHORT, "alt": 62}, "FinCom Books hold Tally's entry read back (%s)" % voucher(pg, vid))
        ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "the window closes by itself")
        rows = group(pg, WHAT)
        ok(not rows or vid not in rows, "the row has left What to fix (%s)" % rows)
        h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); return h ? h.textContent.replace(/\\s+/g, ' ') : ''; }")
        ok(LONG in h and SHORT in h and "already exists" in h, "Changes made here: the refused one with Tally's words and the saved one (%s)" % h[:300])
        ok(pg.evaluate("(a) => (S.books.fixq || []).every(x => x.cid === a)", A), "each change is kept with the client it was made for (cid)")
        ok(not pg.evaluate("() => !!document.querySelector('#app [data-fix-undo]')"), "no Undo back to a number the portal refuses")

        # ok without a read back: saved in Tally, FinCom Books at the next read
        st = try_save(pg, vid, "(b) => ({body: {ok: true, message: 'Saved in Tally.', after: {number: b.fields.number, alterId: '999'}}})")
        ok(st and st[0] == "done" and "Saved in Tally" in st[1] and "FinCom Books" in st[1] and st[1] != "Saved in Tally and FinCom Books.", "saved without the entry read back: not said to be in FinCom Books yet (%s)" % st)
        cancel(pg)

        # 5. kept, unknown, gone, refused before sending: said, and never sent again by itself
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, LONG, 300])
        st = try_save(pg, vid, "(b) => ({body: {ok: false, kept: true, message: 'Tally kept its own value. This is how the entry is now.', after: {number: 'x', alterId: '300'}, xml: window.__xml}})")
        ok(st and st[0] == "kept" and "Tally kept its own value" in st[1] and voucher(pg, vid)["alt"] == 300, "kept: said, and Tally's entry brought in (%s, %s)" % (st, voucher(pg, vid)))
        cancel(pg)
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, "(b) => ({body: {ok: false, unknown: true, message: 'Tally did not answer. Ask Tally again to see whether it changed.'}})")
        ok(st and st[0] == "unknown" and "Ask Tally again" in st[1], "unknown: said (%s)" % st)
        pump(pg); ok(len(calls(pg)) == 1, "unknown: never sent again by itself (%d calls)" % len(calls(pg)))
        again = pg.evaluate("() => !!document.querySelector('[data-fix-entry] [data-fix-again]')")
        ok(again, "unknown: Ask Tally again is offered")
        answer(pg, DONE)
        if again: pg.click("[data-fix-entry] [data-fix-again]"); pg.wait_for_timeout(900)
        st = state(pg)
        ok(len(calls(pg)) == 2 and st and st[0] == "done", "Ask Tally again (a person's press): sent once more, saved (%s)" % st)
        cancel(pg)
        for js, kind, words in (("(b) => ({body: {ok: false, gone: true, message: 'Tally no longer has this entry.'}})", "gone", "Tally no longer has this entry."),
                                ("(b) => ({body: {ok: false, message: 'Open the entry again: FinCom needs its change number from Tally first.'}})", "refused", "Open the entry again")):
            pg.evaluate("() => { window.__calls = []; }")
            st = try_save(pg, vid, js)
            ok(st and st[0] == kind and words in st[1], "%s: said (%s)" % (kind, st))
            pump(pg); ok(len(calls(pg)) == 1, "%s: never sent again by itself (%d calls)" % (kind, len(calls(pg))))
            cancel(pg)

        # 7. an older FinCom Bridge: says which one is needed, never sent again by itself
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, OLD)
        ok(st and st[0] == "old" and "FinCom Bridge 2.5.21" in st[1], "404 Unknown address /fix: needs FinCom Bridge 2.5.21 (%s)" % st)
        shot(pg, "classic-light-needs-newer-bridge")
        pump(pg); pg.evaluate("() => render()"); pg.wait_for_timeout(300)
        ok(len(calls(pg)) == 1, "an older bridge: never sent again by itself (%d calls)" % len(calls(pg)))
        cancel(pg)

        # 6. held (Tally closed) and no answer: kept, Waiting for Tally, Save off; sent when Tally is open
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, HELD)
        ok(st and st[0] == "waiting" and st[1] == WAIT, "held, Tally closed: Waiting for Tally (%s)" % st)
        ok(save_off(pg), "held: Save is off while the change waits")
        shot(pg, "classic-light-waiting")
        cancel(pg); open_entry(pg, WHAT, vid); typein(pg, SHORT)
        ok(save_off(pg), "held: opened again, Save is still off while the change waits")
        cancel(pg)
        answer(pg, DONE); pump(pg)
        c = calls(pg)
        ok(len(c) >= 2 and all(x[1] == c[0][1] for x in c) and pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state") == "done", "held: sent again when Tally is open (the same change), and saved (%d calls)" % len(c))
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, "(b) => 'net'", 1500)
        ok(st and st[0] == "waiting", "no answer from FinCom Bridge: kept, Waiting for Tally (%s)" % st)
        cancel(pg); answer(pg, DONE); pump(pg, 1500)
        ok(len(calls(pg)) == 2 and pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state") == "done", "no answer: sent again when the bridge answers (%d calls)" % len(calls(pg)))
        # Tally closed here (no bridge live): kept, nothing sent
        pg.evaluate("() => { window.__live = false; window.__calls = []; }")
        st = try_save(pg, vid, DONE, 500)
        ok(st and st[0] == "waiting" and len(calls(pg)) == 0, "Tally not open here: kept, nothing sent (%s)" % st)
        cancel(pg); pg.evaluate("() => { window.__live = true; }"); pump(pg)
        ok(len(calls(pg)) == 1, "Tally open again: the kept change is sent")

        # 8. another client opened while the change is with Tally: the answer goes to the client it was made for
        B = pg.evaluate("() => { const c = newCompany({name: 'ZZ Other Client', gstin: '27AAGCL4827M1Z1'}); S.companies[c.id] = c; return c.id; }")
        pg.evaluate("() => { window.__calls = []; window.__go = null; }")
        alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
        month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
        pg.evaluate("() => { window.__ans = " + DONE + "; window.__fix = (b) => { const a = window.__ans(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
        pg.evaluate("(b) => { S.coId = b; return openBooksNow(b); }", B); pg.wait_for_timeout(800)
        ok(pg.evaluate("() => !(S.gstFix || {}).pop && !document.querySelector('[data-fix-entry]')"), "another client opened: the window is closed")
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1500)
        c = calls(pg)
        ok(len(c) == 1 and c[0][1].get("companyGuid") == "g-" + A and "ZZ Other" not in c[0][1].get("company", ""), "the change went to the client it was made for (%s)" % (c[0][1] if c else None))
        other = pg.evaluate("(a) => ({cid: S.books.cid, fixq: (S.books.fixq || []).length, has: (S.books.vouchers || []).some(v => v.id === a)})", vid)
        ok(other == {"cid": B, "fixq": 0, "has": False}, "the client open now is untouched (%s)" % other)
        kept = pg.evaluate("(a) => Books.load(a[0]).then(b => { const r = (b.fixq || [])[b.fixq.length - 1], v = b.vouchers.find(x => x.id === a[1]); return [r && r.state, r && r.cid, v && v.no, v && v.alt]; })", [A, vid])
        ok(kept == ["done", A, SHORT, alt[0] + 1], "the answer is in the books of the client it was made for (%s)" % kept)

        # ... and during the sending of the held ones
        pg.evaluate("(a) => { S.coId = a; return openBooksNow(a); }", A); pg.wait_for_timeout(1500)
        pg.evaluate("() => { window.__live = false; window.__calls = []; }")
        try_save(pg, vid, DONE, 500); cancel(pg)
        pg.evaluate("() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq[b.fixq.length - 1])); x.id = 'fx-second'; b.fixq.push(x); return saveBooks(); }")
        pg.evaluate("() => { window.__live = true; window.__fix = (b) => { const a = window.__ans(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
        pg.evaluate("() => { window.FixQ.last = 0; window.FixQ.pump(true); }"); pg.wait_for_timeout(500)
        pg.evaluate("(b) => { S.coId = b; return openBooksNow(b); }", B); pg.wait_for_timeout(800)
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1500)
        c = calls(pg)
        ok(len(c) == 1 and c[0][1].get("companyGuid") == "g-" + A, "another client opened during the sending: the one with Tally finishes for its own client, the rest wait (%d calls)" % len(c))
        other = pg.evaluate("() => ({cid: S.books.cid, fixq: (S.books.fixq || []).length})")
        ok(other == {"cid": B, "fixq": 0}, "the client open now is untouched (%s)" % other)
        kept = pg.evaluate("(a) => Books.load(a).then(b => b.fixq.slice(-2).map(x => x.state))", A)
        ok(kept == ["done", "waiting"], "the client the changes were made for: the first saved, the second still waiting (%s)" % kept)
        pg.evaluate("(a) => { S.coId = a; return openBooksNow(a); }", A); pg.wait_for_timeout(1500)
        answer(pg, DONE); pump(pg)

        # 9. GSTIN on the ledger: its AlterID sent when FinCom Books have it; Undo once, marked used once Tally took it
        month(pg, "202504")
        what2 = "Buyer GSTINs that are not valid"
        rows = group(pg, what2)
        gid = rows[0] if rows else ""
        w = open_entry(pg, what2, gid)
        ok(w["kind"] == "gstin" and w["input"] == ["gstin", BADG] and "Changed on the party ledger in Tally, then on this party's invoices of the month." in w["text"], "GSTIN not valid: the party ledger's GSTIN in its box (%s)" % {k: w[k] for k in ("kind", "input")})
        led = pg.evaluate("(g) => S.books.vouchers.find(v => v.id === g).party", gid)
        pg.evaluate("(l) => { S.books.ledInfo = S.books.ledInfo || {}; S.books.ledInfo[l] = Object.assign({}, S.books.ledInfo[l], {alt: 33}); }", led)
        good = pg.evaluate("() => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid('07AAJFQ3158R1Z' + c)) return '07AAJFQ3158R1Z' + c; }")
        typein(pg, good)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: '34'}, before: {gstin: b.was.gstin, alterId: '33'}}}); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(900)
        c = calls(pg); b = c[0][1] if c else {}
        ok(b.get("target") == "ledger" and b.get("fields") == {"gstin": good} and b.get("was") == {"gstin": BADG} and b.get("ledger") == led and b.get("alterId") == "33",
           "the ledger's GSTIN is sent, with the one FinCom showed and the ledger's AlterID (%s)" % b)
        ok(pg.evaluate("(l) => S.books.gstins[l]", led) == good and pg.evaluate("(l) => S.books.ledInfo[l].alt", led) in (34, "34"), "FinCom Books take the ledger read back, with its AlterID")
        invoice_steps(pg, what2, gid, led, good)
        cancel(pg); month(pg, "202504")
        # a GSTIN changed from one valid GSTIN to another: Undo offered
        good2 = pg.evaluate("() => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid('07AAJFQ3159R1Z' + c)) return '07AAJFQ3159R1Z' + c; }")
        pg.evaluate("""(a) => { S.books.fixq.push({id: 'fx-led', cid: a[0], at: '2026-11-20T10:00:00Z', by: '', kind: 'gstin', vid: '', state: 'done', was: a[2], to: a[3],
          label: 'GSTIN of ' + a[1] + ': ' + a[2] + ' → ' + a[3], before: {gstin: a[2], alterId: '33'}, after: {gstin: a[3], pan: '', alterId: '34'},
          ask: {target: 'ledger', ledger: a[1], was: {gstin: a[2]}, fields: {gstin: a[3]}, alterId: '33'}}); render(); }""", [A, led, good, good2])
        pg.wait_for_timeout(300)
        pg.evaluate("() => { window.__calls = []; window.__go = null; window.__fix = (b) => new Promise((r) => { window.__go = () => r({body: {ok: false, refused: true, message: 'Tally did not change it: no.'}}); }); }")
        pg.evaluate("() => { document.querySelector('#app [data-fix-history]').open = true; }"); pg.wait_for_timeout(200)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-led\"]'); u.click(); u.click(); }"); pg.wait_for_timeout(600)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-led\"]'); if (u) u.click(); }"); pg.wait_for_timeout(300)
        ok(len(calls(pg)) == 1, "Undo pressed twice: one change sent (%d)" % len(calls(pg)))
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(900)
        UND = "() => { const r = S.books.fixq.find(x => x.id === 'fx-led'); return [!!r.undone, !!document.querySelector('#app [data-fix-undo=\"fx-led\"]')]; }"
        und = pg.evaluate(UND)
        ok(und == [False, True], "Undo refused by Tally: not marked used, Undo still offered (%s)" % und)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: '35'}, before: {gstin: b.was.gstin}}}); }")
        pg.evaluate("() => document.querySelector('#app [data-fix-undo=\"fx-led\"]').click()"); pg.wait_for_timeout(900)
        c = calls(pg); b = c[0][1] if c else {}
        und = pg.evaluate(UND)
        ok(b.get("fields") == {"gstin": good} and b.get("was") == {"gstin": good2} and b.get("alterId") == "34" and und == [True, False],
           "Undo taken by Tally: the earlier GSTIN sent with the ledger's AlterID now, then marked used (%s, %s)" % (b, und))

        # Undo of a place of supply: back to Tally's own value (the bridge's before), not FinCom's
        pg.evaluate("""(a) => { S.books.fixq.push({id: 'fx-pos', cid: a[0], at: '2026-11-20T10:00:00Z', by: '', kind: 'pos', vid: a[1], state: 'done', was: '07', to: '27',
          label: 'Place of supply of X: Delhi → Maharashtra', before: {pos: 'Haryana', alterId: '40'}, after: {pos: 'Maharashtra', alterId: '41'},
          ask: {target: 'voucher', guid: a[1], alterId: '40', vchType: 'Sales', vchDate: '20250701', fields: {pos: '27'}}}); render(); }""", [A, vid])
        pg.wait_for_timeout(300)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: false, refused: true, message: 'Tally did not change it: test.'}}); document.querySelector('#app [data-fix-history]').open = true; }"); pg.wait_for_timeout(200)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-pos\"]'); if (u) u.click(); }"); pg.wait_for_timeout(800)
        c = calls(pg); b = c[0][1] if c else {}
        ok(b.get("fields") == {"pos": "Haryana"} and b.get("alterId") == "41", "Undo of a place of supply: Tally's own earlier value, with the change number after (%s)" % b)

        should_fix(pg, vid)

        # the invoices step and the ledger read first, in New look, dark
        pg.evaluate("() => { window.FCNewLook.set(true); }"); pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(800)
        month(pg, "202504"); what2 = "Buyer GSTINs that are not valid"
        bad_again(pg, gid, BADG); pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
        open_entry(pg, what2, gid); typein(pg, good)
        pg.evaluate("() => { window.__tallyG = '" + BADG + "'; const f = " + GSTFIX + "; window.__go = null; window.__fix = (b) => b.readFirst ? new Promise((r) => { window.__go = () => r(f(b)); }) : f(b); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500); shot(pg, "newlook-dark-ledger-read-first")
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1200); shot(pg, "newlook-dark-invoices")
        ok((inv_state(pg) or {}).get("step") == "invoices", "New look dark: the invoices step after the ledger read first and saved")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1500)
        pg.evaluate("() => { window.FCNewLook.set(false); }"); pg.emulate_media(color_scheme="light")

        # the four answers in New look, dark
        pg.evaluate("() => { window.FCNewLook.set(true); }"); pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(800)
        dark_shots(pg, vid, "newlook-dark")
        pg.evaluate("() => { window.FCNewLook.set(false); }"); pg.emulate_media(color_scheme="light")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
        try_save(pg, vid, REFUSED)
        ok(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone width: no sideways scroll")
        shot(pg, "phone-refused")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("exception: %s" % e)
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("FAILED: %d" % len(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
